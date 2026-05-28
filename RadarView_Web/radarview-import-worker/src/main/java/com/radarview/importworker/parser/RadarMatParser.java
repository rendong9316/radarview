package com.radarview.importworker.parser;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.radarview.importworker.entity.BatchTrack;
import com.radarview.importworker.entity.TrackPosition;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Slf4j
@Component
public class RadarMatParser {

    private final ObjectMapper objectMapper = new ObjectMapper();

    public ParsedTracks parse(String filePath, String mode) {
        ParsedTracks result = new ParsedTracks();

        try {
            List<String> command = new ArrayList<>();
            command.add("convert_mat.exe");
            command.add(filePath);

            if ("raw".equalsIgnoreCase(mode)) {
                command.add("--mode");
                command.add("raw");
            }

            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.directory(new File("."));
            processBuilder.redirectErrorStream(true);

            log.info("Running convert_mat.exe for file: {} mode: {}", filePath, mode);
            Process process = processBuilder.start();

            // Read stdout
            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            }

            boolean finished = process.waitFor(120, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.error("convert_mat.exe timed out after 120s for file: {}", filePath);
                return result;
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                log.error("convert_mat.exe exited with code {} for file: {}", exitCode, filePath);
                return result;
            }

            String jsonOutput = output.toString().trim();
            if (jsonOutput.isEmpty()) {
                log.warn("convert_mat.exe produced empty output for file: {}", filePath);
                return result;
            }

            // Parse JSON output
            result = parseJsonOutput(jsonOutput);

        } catch (Exception e) {
            log.error("Error parsing .mat file: {}", filePath, e);
        }

        return result;
    }

    @SuppressWarnings("unchecked")
    private ParsedTracks parseJsonOutput(String jsonOutput) {
        ParsedTracks result = new ParsedTracks();

        try {
            // Expected JSON format: { "tracks": [ { "icaoAddress": "...", "positions": [...], ... }, ... ] }
            Map<String, Object> root = objectMapper.readValue(jsonOutput,
                    new TypeReference<Map<String, Object>>() {});

            List<Map<String, Object>> tracksList = (List<Map<String, Object>>) root.get("tracks");
            if (tracksList == null) {
                log.warn("No 'tracks' key found in parser output");
                return result;
            }

            int trackIndex = 0;
            for (Map<String, Object> trackJson : tracksList) {
                BatchTrack track = new BatchTrack();
                track.setIcaoAddress((String) trackJson.get("icaoAddress"));
                track.setFlightNo((String) trackJson.get("flightNo"));
                track.setIcaoFlightNo((String) trackJson.get("icaoFlightNo"));
                track.setAircraftType((String) trackJson.get("aircraftType"));
                track.setRegistration((String) trackJson.get("registration"));
                track.setAirline((String) trackJson.get("airline"));
                track.setOrigin((String) trackJson.get("origin"));
                track.setDestination((String) trackJson.get("destination"));

                List<Map<String, Object>> positionsJson = (List<Map<String, Object>>) trackJson.get("positions");
                List<TrackPosition> positions = new ArrayList<>();

                if (positionsJson != null) {
                    for (Map<String, Object> posJson : positionsJson) {
                        TrackPosition pos = new TrackPosition();
                        pos.setTimestamp(toLong(posJson.get("timestamp")));
                        pos.setLatitude(toDouble(posJson.get("latitude")));
                        pos.setLongitude(toDouble(posJson.get("longitude")));
                        pos.setAltitude(toDouble(posJson.get("altitude")));
                        pos.setHeading(toDouble(posJson.get("heading")));
                        pos.setGroundSpeed(toDouble(posJson.get("groundSpeed")));
                        pos.setVerticalRate(toDouble(posJson.get("verticalRate")));
                        positions.add(pos);
                    }

                    // Sort positions by timestamp
                    positions.sort((a, b) -> {
                        if (a.getTimestamp() == null && b.getTimestamp() == null) return 0;
                        if (a.getTimestamp() == null) return -1;
                        if (b.getTimestamp() == null) return 1;
                        return Long.compare(a.getTimestamp(), b.getTimestamp());
                    });
                }

                track.setPositionCount(positions.size());
                if (!positions.isEmpty()) {
                    track.setMinTimestamp(positions.get(0).getTimestamp());
                    track.setMaxTimestamp(positions.get(positions.size() - 1).getTimestamp());
                }

                result.addTrack(track);
                result.addPositions(trackIndex, positions);
                trackIndex++;
            }

            log.info("Radar .mat parser: parsed {} tracks, {} total positions",
                    result.getTrackCount(), result.getTotalPositionCount());

        } catch (Exception e) {
            log.error("Failed to parse convert_mat.exe JSON output", e);
        }

        return result;
    }

    private Long toLong(Object value) {
        if (value == null) return null;
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        try {
            return Long.parseLong(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Double toDouble(Object value) {
        if (value == null) return null;
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        try {
            return Double.parseDouble(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
