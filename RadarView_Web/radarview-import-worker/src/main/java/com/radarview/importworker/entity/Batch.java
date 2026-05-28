package com.radarview.importworker.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("batches")
public class Batch {

    @TableId(type = IdType.AUTO)
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
