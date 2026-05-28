package com.radarview.track.service.impl;

import com.radarview.common.dto.BatchInfo;
import com.radarview.common.exception.BusinessException;
import com.radarview.common.result.ResultCode;
import com.radarview.track.entity.Batch;
import com.radarview.track.mapper.BatchMapper;
import com.radarview.track.service.BatchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class BatchServiceImpl implements BatchService {

    private final BatchMapper batchMapper;

    @Override
    @Cacheable(value = "allBatches", unless = "#result == null || #result.isEmpty()")
    public List<BatchInfo> getAllBatches() {
        List<Batch> batches = batchMapper.selectList(null);
        return batches.stream()
                .map(this::toBatchInfo)
                .collect(Collectors.toList());
    }

    @Override
    @Cacheable(value = "batch", key = "#id", unless = "#result == null")
    public BatchInfo getBatch(Long id) {
        Batch batch = batchMapper.selectById(id);
        if (batch == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "Batch not found: " + id);
        }
        return toBatchInfo(batch);
    }

    @Override
    @CacheEvict(value = {"batch", "allBatches"}, key = "#id")
    public void deleteBatch(Long id) {
        batchMapper.deleteById(id);
    }

    private BatchInfo toBatchInfo(Batch batch) {
        BatchInfo info = new BatchInfo();
        info.setId(batch.getId());
        info.setFileName(batch.getFileName());
        info.setSource(batch.getSource());
        info.setTrackCount(batch.getTrackCount());
        info.setFileHash(batch.getFileHash());
        info.setFileSize(batch.getFileSize());
        info.setImportedBy(batch.getImportedBy());
        info.setStatus(batch.getStatus());
        info.setErrorMsg(batch.getErrorMsg());
        info.setImportedAt(batch.getImportedAt());
        return info;
    }
}
