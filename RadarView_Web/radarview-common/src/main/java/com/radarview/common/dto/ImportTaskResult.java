package com.radarview.common.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ImportTaskResult {

    private String taskId;

    private Long batchId;

    private Boolean success;

    private Integer trackCount;

    private String errorMsg;
}
