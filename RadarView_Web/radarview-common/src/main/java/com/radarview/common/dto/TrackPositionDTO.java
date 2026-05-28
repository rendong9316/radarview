package com.radarview.common.dto;

import lombok.Data;

@Data
public class TrackPositionDTO {

    private Long timestamp;

    private Double latitude;

    private Double longitude;

    private Double altitude;

    private Double heading;

    private Double groundSpeed;

    private Double verticalRate;
}
