package com.radarview.track.controller;

import com.radarview.common.dto.BatchInfo;
import com.radarview.common.dto.ImportTaskResult;
import com.radarview.common.dto.TrackDetailDTO;
import com.radarview.common.result.ApiResponse;
import com.radarview.track.service.TrackService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class TrackController {

    private final TrackService trackService;

    @PostMapping("/tracks/import/adsb")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<ImportTaskResult> importAdsb(
            @RequestPart("file") MultipartFile file,
            @RequestHeader("X-User-Id") Long userId) {
        log.info("ADS-B import request: user={}, file={}, size={}", userId,
                file.getOriginalFilename(), file.getSize());
        ImportTaskResult result = trackService.importAdsb(userId, file);
        return ApiResponse.success(result);
    }

    @PostMapping("/tracks/import/radar")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<ImportTaskResult> importRadar(
            @RequestPart("file") MultipartFile file,
            @RequestHeader("X-User-Id") Long userId) {
        log.info("Radar import request: user={}, file={}, size={}", userId,
                file.getOriginalFilename(), file.getSize());
        ImportTaskResult result = trackService.importRadar(userId, file);
        return ApiResponse.success(result);
    }

    @PostMapping("/tracks/import/radar-raw")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApiResponse<ImportTaskResult> importRadarRaw(
            @RequestPart("file") MultipartFile file,
            @RequestHeader("X-User-Id") Long userId) {
        log.info("Radar raw import request: user={}, file={}, size={}", userId,
                file.getOriginalFilename(), file.getSize());
        ImportTaskResult result = trackService.importRadarRaw(userId, file);
        return ApiResponse.success(result);
    }

    @GetMapping("/tracks")
    public ApiResponse<List<TrackDetailDTO>> getAllTracks() {
        List<TrackDetailDTO> tracks = trackService.getAllTracks();
        return ApiResponse.success(tracks);
    }

    @GetMapping("/tracks/batch/{batchId}")
    public ApiResponse<List<TrackDetailDTO>> getTracksByBatch(@PathVariable Long batchId) {
        List<TrackDetailDTO> tracks = trackService.getTracksByBatch(batchId);
        return ApiResponse.success(tracks);
    }

    @GetMapping("/batches")
    public ApiResponse<List<BatchInfo>> getAllBatches() {
        List<BatchInfo> batches = trackService.getAllBatches();
        return ApiResponse.success(batches);
    }

    @GetMapping("/batches/{batchId}")
    public ApiResponse<BatchInfo> getBatchInfo(@PathVariable Long batchId) {
        BatchInfo batch = trackService.getBatchInfo(batchId);
        return ApiResponse.success(batch);
    }

    @DeleteMapping("/batches/{batchId}")
    public ApiResponse<Void> deleteBatch(@PathVariable Long batchId) {
        trackService.deleteBatch(batchId);
        return ApiResponse.success();
    }
}
