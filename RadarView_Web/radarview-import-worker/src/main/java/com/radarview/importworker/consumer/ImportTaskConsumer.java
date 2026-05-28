package com.radarview.importworker.consumer;

import com.radarview.common.dto.ImportProgressMessage;
import com.radarview.common.dto.ImportTaskResult;
import com.radarview.common.enums.BatchStatus;
import com.radarview.common.enums.ImportStage;
import com.radarview.importworker.entity.Batch;
import com.radarview.importworker.entity.BatchTrack;
import com.radarview.importworker.entity.TrackPosition;
import com.radarview.importworker.mapper.BatchMapper;
import com.radarview.importworker.mapper.BatchTrackMapper;
import com.radarview.importworker.mapper.TrackPositionMapper;
import com.radarview.importworker.parser.AdsbCsvParser;
import com.radarview.importworker.parser.ParsedTracks;
import com.radarview.importworker.parser.RadarMatParser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class ImportTaskConsumer {

    private static final int BATCH_INSERT_SIZE = 500;

    private final BatchMapper batchMapper;
    private final BatchTrackMapper batchTrackMapper;
    private final TrackPositionMapper trackPositionMapper;
    private final AdsbCsvParser adsbCsvParser;
    private final RadarMatParser radarMatParser;
    private final RabbitTemplate rabbitTemplate;

    @RabbitListener(queues = "track.import.queue")
    public void handleImportTask(ImportTaskMessage message) {
        log.info("Received import task: taskId={}, batchId={}, source={}, file={}",
                message.getTaskId(), message.getBatchId(), message.getSource(),
                message.getOriginalFileName());

        try {
            // Update batch status to PROCESSING
            updateBatchStatus(message.getBatchId(), BatchStatus.PROCESSING.name(), null, null);

            // Notify progress: parsing
            sendProgress(message, ImportStage.PARSING, 10);

            // Parse file based on source
            ParsedTracks parsed;
            String source = message.getSource();
            if ("ADS-B".equalsIgnoreCase(source) || "ADS_B".equalsIgnoreCase(source)) {
                parsed = adsbCsvParser.parse(message.getFilePath());
            } else if ("Radar".equalsIgnoreCase(source)) {
                parsed = radarMatParser.parse(message.getFilePath(), "standard");
            } else if ("RadarRaw".equalsIgnoreCase(source) || "RADAR_RAW".equalsIgnoreCase(source)) {
                parsed = radarMatParser.parse(message.getFilePath(), "raw");
            } else {
                throw new IllegalArgumentException("Unknown source type: " + source);
            }

            if (parsed.getTrackCount() == 0) {
                log.warn("No tracks parsed from file: {}", message.getOriginalFileName());
                updateBatchStatus(message.getBatchId(), BatchStatus.COMPLETED.name(), 0, "No tracks found in file");
                sendFinalResult(message, true, 0, null);
                return;
            }

            // Notify progress: saving
            sendProgress(message, ImportStage.SAVING, 30);

            // Save tracks and positions
            int totalTracks = saveParsedTracks(message.getBatchId(), source, parsed);

            // Update batch status to COMPLETED
            updateBatchStatus(message.getBatchId(), BatchStatus.COMPLETED.name(), totalTracks, null);

            // Notify final result
            sendProgress(message, ImportStage.DONE, 100);
            sendFinalResult(message, true, totalTracks, null);

            log.info("Import task completed: taskId={}, batchId={}, tracks={}, positions={}",
                    message.getTaskId(), message.getBatchId(),
                    totalTracks, parsed.getTotalPositionCount());

        } catch (Exception e) {
            log.error("Import task failed: taskId={}, batchId={}", message.getTaskId(), message.getBatchId(), e);
            updateBatchStatus(message.getBatchId(), BatchStatus.FAILED.name(), null,
                    e.getMessage() != null ? e.getMessage() : "Unknown error");
            sendFinalResult(message, false, 0, e.getMessage());
        }
    }

    @Transactional(rollbackFor = Exception.class)
    protected int saveParsedTracks(Long batchId, String source, ParsedTracks parsed) {
        int savedCount = 0;
        int totalTracks = parsed.getTrackCount();

        for (int i = 0; i < totalTracks; i++) {
            BatchTrack track = parsed.getTracks().get(i);
            List<TrackPosition> positions = parsed.getPositionsByTrackIndex().get(i);

            track.setBatchId(batchId);
            track.setSource(source);
            batchTrackMapper.insert(track);

            Long trackId = track.getId();

            // Batch insert positions in chunks of BATCH_INSERT_SIZE
            for (int j = 0; j < positions.size(); j += BATCH_INSERT_SIZE) {
                int end = Math.min(j + BATCH_INSERT_SIZE, positions.size());
                List<TrackPosition> chunk = positions.subList(j, end);

                for (TrackPosition pos : chunk) {
                    pos.setTrackId(trackId);
                    pos.setBatchId(batchId);
                    trackPositionMapper.insert(pos);
                }
            }

            savedCount++;
        }

        return savedCount;
    }

    private void updateBatchStatus(Long batchId, String status, Integer trackCount, String errorMsg) {
        Batch batch = batchMapper.selectById(batchId);
        if (batch != null) {
            batch.setStatus(status);
            if (trackCount != null) {
                batch.setTrackCount(trackCount);
            }
            if (errorMsg != null) {
                batch.setErrorMsg(errorMsg);
            }
            batchMapper.updateById(batch);
        }
    }

    private void sendProgress(ImportTaskMessage message, ImportStage stage, int percent) {
        try {
            ImportProgressMessage progress = new ImportProgressMessage(
                    message.getTaskId(),
                    message.getBatchId(),
                    stage.name(),
                    percent,
                    message.getUserId()
            );
            rabbitTemplate.convertAndSend("track.import.exchange",
                    "track.import.progress", progress);
        } catch (Exception e) {
            log.warn("Failed to send progress message: {}", e.getMessage());
        }
    }

    private void sendFinalResult(ImportTaskMessage message, boolean success, int trackCount, String errorMsg) {
        try {
            ImportTaskResult result = new ImportTaskResult(
                    message.getTaskId(),
                    message.getBatchId(),
                    success,
                    trackCount,
                    errorMsg
            );
            rabbitTemplate.convertAndSend("track.import.exchange",
                    "track.import.result", result);
        } catch (Exception e) {
            log.warn("Failed to send result message: {}", e.getMessage());
        }
    }
}
