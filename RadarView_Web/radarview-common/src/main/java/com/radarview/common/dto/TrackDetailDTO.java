package com.radarview.common.dto;

import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.List;

@Data
@EqualsAndHashCode(callSuper = true)
public class TrackDetailDTO extends TrackInfo {

    private List<TrackPositionDTO> positions;
}
