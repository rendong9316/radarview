package com.radarview.importworker.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ParsedTracks {
    private java.util.List<com.radarview.importworker.entity.BatchTrack> tracks;
    private java.util.Map<Integer, java.util.List<com.radarview.importworker.entity.TrackPosition>> positionsByTrackIndex;
}
