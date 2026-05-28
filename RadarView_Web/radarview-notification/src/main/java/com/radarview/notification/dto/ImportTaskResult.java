package com.radarview.notification.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ImportTaskResult implements Serializable {

    private static final long serialVersionUID = 1L;

    private String batchId;
    private String userId;
    private String status;
    private int totalCount;
    private int successCount;
    private int errorCount;
    private String message;
    private long durationMs;
    private long timestamp;
}
