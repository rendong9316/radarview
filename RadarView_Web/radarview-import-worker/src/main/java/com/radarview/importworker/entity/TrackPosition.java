package com.radarview.importworker.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("track_positions")
public class TrackPosition {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long trackId;

    private Long batchId;

    private Long timestamp;

    private Double latitude;

    private Double longitude;

    private Double altitude;

    private Double heading;

    private Double groundSpeed;

    private Double verticalRate;
}
