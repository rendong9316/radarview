package com.radarview.track.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("batch_tracks")
public class BatchTrack {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long batchId;

    private String icaoAddress;

    private String flightNo;

    private String icaoFlightNo;

    private String aircraftType;

    private String registration;

    private String airline;

    private String origin;

    private String destination;

    private String source;

    private Integer positionCount;

    private Long minTimestamp;

    private Long maxTimestamp;
}
