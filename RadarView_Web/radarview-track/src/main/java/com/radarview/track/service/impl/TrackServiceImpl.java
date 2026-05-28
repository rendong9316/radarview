package com.radarview.track.service.impl;

import com.radarview.common.dto.BatchInfo;
import com.radarview.common.dto.ImportTaskResult;
import com.radarview.common.dto.TrackDetailDTO;
import com.radarview.common.dto.TrackPositionDTO;
import com.radarview.common.enums.BatchStatus;
import com.radarview.common.enums.DataSource;
import com.radarview.common.exception.BusinessException;
import com.radarview.common.result.ResultCode;
import com.radarview.track.config.RabbitConfig;
import com.radarview.track.entity.Batch;
import com.radarview.track.entity.BatchTrack;
import com.radarview.track.entity.TrackPosition;
import com.radarview.track.mapper.BatchMapper;
import com.radarview.track.mapper.BatchTrackMapper;
import com.radarview.track.mapper.TrackPositionMapper;
import com.radarview.track.service.BatchService;
import com.radarview.track.service.TrackService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class TrackServiceImpl implements TrackService {

    private final BatchMapper batchMapper;
    private final BatchTrackMapper batchTrackMapper;
    private final TrackPositionMapper trackPositionMapper;
    private final BatchService batchService;
    private final RedissonClient redissonClient;
    private final RabbitTemplate rabbitTemplate;

    @Value("${file.upload-dir:/data/uploads}")
    private String uploadDir;

    @Override
    public ImportTaskResult importAdsb(Long userId, MultipartFile file) {
        return doImport(userId, file, DataSource.ADS_B);
    }

    @Override
    public ImportTaskResult importRadar(Long userId, MultipartFile file) {
        return doImport(userId, file, DataSource.RADAR);
    }

    @Override
    public ImportTaskResult importRadarRaw(Long userId, MultipartFile file) {
        return doImport(userId, file, DataSource.RADAR_RAW);
    }

    private ImportTaskResult doImport(Long userId, MultipartFile file, DataSource source) {
        String originalFileName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "unknown";
        String taskId = UUID.randomUUID().toString();
        String fileHash;

        // Save file to disk and compute hash
        Path filePath = saveUploadedFile(file, originalFileName, source);
        try {
            fileHash = computeSha256(filePath);
        } catch (Exception e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "Failed to compute file hash: " + e.getMessage());
        }

        // Dedup check with distributed lock
        String lockKey = "import:lock:" + fileHash;
        RLock lock = redissonClient.getLock(lockKey);
        try {
            if (!lock.tryLock(10, 30, TimeUnit.SECONDS)) {
                throw new BusinessException(ResultCode.BAD_REQUEST, "Another import with the same file is in progress");
            }

            Batch existing = batchMapper.findByFileName(originalFileName);
            if (existing != null && fileHash.equals(existing.getFileHash())) {
                log.info("Duplicate file detected: {} (batchId={})", originalFileName, existing.getId());
                return ImportTaskResult.builder()
                        .taskId(taskId)
                        .batchId(existing.getId())
                        .success(false)
                        .errorMsg("File already imported (batch #" + existing.getId() + ")")
                        .build();
            }

            // Create batch record with PROCESSING status
            Batch batch = new Batch();
            batch.setFileName(originalFileName);
            batch.setSource(source.getValue());
            batch.setStatus(BatchStatus.PROCESSING.name());
            batch.setFileHash(fileHash);
            batch.setFileSize(file.getSize());
            batch.setImportedBy(userId);
            batch.setImportedAt(LocalDateTime.now());
            batchMapper.insert(batch);

            // Send import task to RabbitMQ
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("taskId", taskId);
            message.put("batchId", batch.getId());
            message.put("source", source.getValue());
            message.put("filePath", filePath.toAbsolutePath().toString());
            message.put("userId", userId);
            message.put("originalFileName", originalFileName);
            message.put("timestamp", System.currentTimeMillis());

            rabbitTemplate.convertAndSend(RabbitConfig.TRACK_IMPORT_EXCHANGE,
                    "track.import." + source.name().toLowerCase(), message);
            log.info("Import task sent: taskId={}, batchId={}, source={}", taskId, batch.getId(), source);

            return ImportTaskResult.builder()
                    .taskId(taskId)
                    .batchId(batch.getId())
                    .success(true)
                    .build();

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "Import lock interrupted");
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Override
    @Cacheable(value = "allTracks", unless = "#result == null || #result.isEmpty()")
    public List<TrackDetailDTO> getAllTracks() {
        log.info("Loading all tracks");
        List<BatchTrack> allTracks = batchTrackMapper.selectList(null);
        return allTracks.stream()
                .map(this::toTrackDetailDTO)
                .collect(Collectors.toList());
    }

    @Override
    public List<TrackDetailDTO> getTracksByBatch(Long batchId) {
        log.info("Loading tracks for batch id: {}", batchId);
        List<BatchTrack> tracks = batchTrackMapper.findByBatchId(batchId);
        return tracks.stream()
                .map(this::toTrackDetailDTO)
                .collect(Collectors.toList());
    }

    @Override
    @Cacheable(value = "allBatches", unless = "#result == null || #result.isEmpty()")
    public List<BatchInfo> getAllBatches() {
        log.info("Loading all batches");
        return batchService.getAllBatches();
    }

    @Override
    public BatchInfo getBatchInfo(Long batchId) {
        return batchService.getBatch(batchId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @CacheEvict(value = {"allTracks", "allBatches"}, allEntries = true)
    public void deleteBatch(Long batchId) {
        log.info("Deleting batch id: {}", batchId);

        Batch batch = batchMapper.selectById(batchId);
        if (batch == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "Batch not found: " + batchId);
        }

        if (BatchStatus.PROCESSING.name().equals(batch.getStatus())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "Cannot delete a batch that is still processing");
        }

        // Delete in order: positions -> tracks -> batch
        trackPositionMapper.deleteByBatchId(batchId);
        batchTrackMapper.deleteByBatchId(batchId);
        batchMapper.deleteById(batchId);

        // Delete uploaded file
        try {
            Path fileDir = Paths.get(uploadDir, "batches", String.valueOf(batchId));
            if (Files.exists(fileDir)) {
                Files.walk(fileDir)
                        .sorted(Comparator.reverseOrder())
                        .forEach(p -> {
                            try {
                                Files.deleteIfExists(p);
                            } catch (IOException e) {
                                log.warn("Failed to delete file: {}", p, e);
                            }
                        });
            }
        } catch (IOException e) {
            log.warn("Failed to clean up batch files for batchId={}", batchId, e);
        }

        log.info("Batch deleted: id={}, fileName={}", batchId, batch.getFileName());
    }

    private TrackDetailDTO toTrackDetailDTO(BatchTrack track) {
        List<TrackPosition> positions = trackPositionMapper.findByTrackId(track.getId());
        List<TrackPositionDTO> positionDTOs = positions.stream()
                .map(this::toTrackPositionDTO)
                .collect(Collectors.toList());

        TrackDetailDTO dto = new TrackDetailDTO();
        dto.setId(track.getId());
        dto.setBatchId(track.getBatchId());
        dto.setIcaoAddress(track.getIcaoAddress());
        dto.setFlightNo(track.getFlightNo());
        dto.setIcaoFlightNo(track.getIcaoFlightNo());
        dto.setAircraftType(track.getAircraftType());
        dto.setRegistration(track.getRegistration());
        dto.setAirline(track.getAirline());
        dto.setOrigin(track.getOrigin());
        dto.setDestination(track.getDestination());
        dto.setSource(track.getSource());
        dto.setPositionCount(track.getPositionCount());
        dto.setMinTimestamp(track.getMinTimestamp());
        dto.setMaxTimestamp(track.getMaxTimestamp());
        dto.setPositions(positionDTOs);
        return dto;
    }

    private TrackPositionDTO toTrackPositionDTO(TrackPosition pos) {
        TrackPositionDTO dto = new TrackPositionDTO();
        dto.setTimestamp(pos.getTimestamp());
        dto.setLatitude(pos.getLatitude());
        dto.setLongitude(pos.getLongitude());
        dto.setAltitude(pos.getAltitude());
        dto.setHeading(pos.getHeading());
        dto.setGroundSpeed(pos.getGroundSpeed());
        dto.setVerticalRate(pos.getVerticalRate());
        return dto;
    }

    private Path saveUploadedFile(MultipartFile file, String originalFileName, DataSource source) {
        try {
            Path sourceDir = Paths.get(uploadDir, "batches", source.name().toLowerCase());
            Files.createDirectories(sourceDir);

            String storedFileName = System.currentTimeMillis() + "_" + originalFileName;
            Path targetPath = sourceDir.resolve(storedFileName);

            try (InputStream inputStream = file.getInputStream()) {
                Files.copy(inputStream, targetPath, StandardCopyOption.REPLACE_EXISTING);
            }

            log.info("File saved: {} ({} bytes)", targetPath, file.getSize());
            return targetPath;
        } catch (IOException e) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "Failed to save uploaded file: " + e.getMessage());
        }
    }

    private String computeSha256(Path filePath) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[8192];
        try (InputStream is = Files.newInputStream(filePath)) {
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }
        }
        byte[] hashBytes = digest.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : hashBytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
