package com.radarview.track.service;

import com.radarview.common.dto.BatchInfo;
import com.radarview.common.dto.ImportTaskResult;
import com.radarview.common.dto.TrackDetailDTO;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface TrackService {

    ImportTaskResult importAdsb(Long userId, MultipartFile file);

    ImportTaskResult importRadar(Long userId, MultipartFile file);

    ImportTaskResult importRadarRaw(Long userId, MultipartFile file);

    List<TrackDetailDTO> getAllTracks();

    List<TrackDetailDTO> getTracksByBatch(Long batchId);

    List<BatchInfo> getAllBatches();

    BatchInfo getBatchInfo(Long batchId);

    void deleteBatch(Long batchId);
}
