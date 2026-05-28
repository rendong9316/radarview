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
public class ImportProgressMessage implements Serializable {

    private static final long serialVersionUID = 1L;

    private String batchId;
    private String userId;
    private int totalCount;
    private int processedCount;
    private int errorCount;
    private String status;
    private String message;
    private long timestamp;
}
