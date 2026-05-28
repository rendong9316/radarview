package com.radarview.common.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ImportProgressMessage {

    private String taskId;

    private Long batchId;

    private String stage;

    private Integer percent;

    private Long userId;
}
