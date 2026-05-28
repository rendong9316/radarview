package com.radarview.importworker.consumer;

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
    private Long userId;
    private String originalFileName;
    private Long timestamp;
}
