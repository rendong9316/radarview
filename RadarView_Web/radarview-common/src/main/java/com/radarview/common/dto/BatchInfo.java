package com.radarview.common.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class BatchInfo {

    private Long id;

    private String fileName;

    private String source;

    private Integer trackCount;

    private String fileHash;

    private Long fileSize;

    private Long importedBy;

    private String status;

    private String errorMsg;

    private LocalDateTime importedAt;
}
