package com.radarview.common.dto;

import lombok.Data;

@Data
public class TrackInfo {

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
