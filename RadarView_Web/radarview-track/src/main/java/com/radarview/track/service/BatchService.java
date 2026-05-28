package com.radarview.track.service;

import com.radarview.common.dto.BatchInfo;

import java.util.List;

public interface BatchService {

    List<BatchInfo> getAllBatches();

    BatchInfo getBatch(Long id);

    void deleteBatch(Long id);
}
