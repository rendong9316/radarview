package com.radarview.importworker.parser;

import com.radarview.importworker.entity.BatchTrack;
import com.radarview.importworker.entity.TrackPosition;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

@Slf4j
@Component
public class AdsbCsvParser {

    private static final double FEET_TO_METERS = 0.3048;

    public ParsedTracks parse(String filePath) throws IOException {
        Path path = Paths.get(filePath);
        ParsedTracks result = new ParsedTracks();

        // Group raw lines by ICAO address
        Map<String, List<String[]>> groupsByIcao = new LinkedHashMap<>();

        try (BufferedReader reader = Files.newBufferedReader(path)) {
            String line;
            boolean isFirstLine = true;
            while ((line = reader.readLine()) != null) {
                // Skip header line
                if (isFirstLine) {
                    isFirstLine = false;
                    String[] firstFields = line.split(",");
                    if (firstFields.length > 0 && isHeader(firstFields)) {
                        continue;
                    }
                    // Fall through: if first line doesn't look like a header, process it as data
                }

                String[] fields = line.split(",");
                if (fields.length < 19) {
                    log.debug("Skipping line with insufficient fields: {} fields, expected 19", fields.length);
                    continue;
                }

                String icaoAddress = fields[0].trim();
                if (icaoAddress.isEmpty()) {
                    continue;
                }

                groupsByIcao.computeIfAbsent(icaoAddress, k -> new ArrayList<>()).add(fields);
            }
        }

        log.info("ADS-B parser: {} unique ICAOs, {} total data lines processed",
                groupsByIcao.size(),
                groupsByIcao.values().stream().mapToInt(List::size).sum());

        int trackIndex = 0;
        for (Map.Entry<String, List<String[]>> entry : groupsByIcao.entrySet()) {
            String icaoAddress = entry.getKey();
            List<String[]> lines = entry.getValue();

            // Sort lines by timestamp
            lines.sort(Comparator.comparingLong(fields -> parseTimestamp(fields[10])));

            // Parse positions
            List<TrackPosition> positions = new ArrayList<>();
            for (String[] fields : lines) {
                TrackPosition pos = parsePosition(fields);
                positions.add(pos);
            }

            // Extract metadata from first line
            String[] firstFields = lines.get(0);
            BatchTrack track = new BatchTrack();
            track.setIcaoAddress(icaoAddress);
            track.setFlightNo(emptyToNull(firstFields[13]));
            track.setIcaoFlightNo(emptyToNull(firstFields[16]));
            track.setAircraftType(emptyToNull(firstFields[8]));
            track.setRegistration(emptyToNull(firstFields[9]));
            track.setAirline(emptyToNull(firstFields[18]));
            track.setOrigin(emptyToNull(firstFields[11]));
            track.setDestination(emptyToNull(firstFields[12]));
            track.setPositionCount(positions.size());
            track.setMinTimestamp(positions.get(0).getTimestamp());
            track.setMaxTimestamp(positions.get(positions.size() - 1).getTimestamp());

            result.addTrack(track);
            result.addPositions(trackIndex, positions);
            trackIndex++;
        }

        log.info("ADS-B parser complete: {} tracks, {} total positions",
                result.getTrackCount(), result.getTotalPositionCount());
        return result;
    }

    private TrackPosition parsePosition(String[] fields) {
        TrackPosition pos = new TrackPosition();
        pos.setLatitude(parseDouble(fields[1]));
        pos.setLongitude(parseDouble(fields[2]));
        pos.setHeading(parseDouble(fields[3]));
        // Altitude: convert feet to meters
        Double altFeet = parseDouble(fields[4]);
        pos.setAltitude(altFeet != null ? altFeet * FEET_TO_METERS : null);
        pos.setGroundSpeed(parseDouble(fields[5]));
        pos.setTimestamp(parseTimestamp(fields[10]));
        pos.setVerticalRate(parseDouble(fields[15]));
        return pos;
    }

    private boolean isHeader(String[] fields) {
        if (fields.length == 0) return false;
        String first = fields[0].trim().toLowerCase();
        return first.equals("icao") || first.equals("icao24") || first.equals("icao_address")
                || first.equals("hex") || first.equals("addr") || first.equals("address");
    }

    private Long parseTimestamp(String field) {
        if (field == null) return null;
        field = field.trim();
        if (field.isEmpty()) return null;

        // Try parsing as epoch milliseconds first
        try {
            return Long.parseLong(field);
        } catch (NumberFormatException ignored) {
            // Continue to date parsing
        }

        // Try YYYY-MM-DD HH:MM:SS format
        try {
            String[] parts = field.split("[ -/:T]");
            if (parts.length >= 6) {
                int year = Integer.parseInt(parts[0]);
                int month = Integer.parseInt(parts[1]);
                int day = Integer.parseInt(parts[2]);
                int hour = Integer.parseInt(parts[3]);
                int minute = Integer.parseInt(parts[4]);
                int second = Integer.parseInt(parts[5]);

                Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
                cal.set(year, month - 1, day, hour, minute, second);
                cal.set(Calendar.MILLISECOND, 0);
                return cal.getTimeInMillis();
            }
        } catch (Exception e) {
            log.debug("Failed to parse timestamp: {}", field, e);
        }

        return null;
    }

    private Double parseDouble(String field) {
        if (field == null) return null;
        field = field.trim();
        if (field.isEmpty()) return null;
        try {
            return Double.parseDouble(field);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String emptyToNull(String field) {
        if (field == null) return null;
        field = field.trim();
        return field.isEmpty() ? null : field;
    }
}
