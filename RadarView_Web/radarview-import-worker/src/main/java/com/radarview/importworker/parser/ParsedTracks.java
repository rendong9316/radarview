package com.radarview.importworker.parser;

import com.radarview.importworker.entity.BatchTrack;
import com.radarview.importworker.entity.TrackPosition;
import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Data
public class ParsedTracks {

    private List<BatchTrack> tracks = new ArrayList<>();
    private Map<Integer, List<TrackPosition>> positionsByTrackIndex = new LinkedHashMap<>();

    public void addTrack(BatchTrack track) {
        tracks.add(track);
    }

    public void addPositions(int trackIndex, List<TrackPosition> positions) {
        positionsByTrackIndex.put(trackIndex, positions);
    }

    public int getTrackCount() {
        return tracks.size();
    }

    public int getTotalPositionCount() {
        int total = 0;
        for (List<TrackPosition> positions : positionsByTrackIndex.values()) {
            total += positions.size();
        }
        return total;
    }
}
