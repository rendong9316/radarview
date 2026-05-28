package com.radarview.importworker.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ImportTaskMessage {
    private String taskId;
    private Long batchId;
    private String source;
    private String filePath;
    private String originalFileName;
    private Long userId;
    private Long timestamp;
}
