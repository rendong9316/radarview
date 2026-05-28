package com.radarview.common.enums;

import lombok.Getter;

@Getter
public enum DataSource {

    ADS_B("ADS-B"),
    RADAR("Radar"),
    RADAR_RAW("RadarRaw");

    private final String value;

    DataSource(String value) {
        this.value = value;
    }

    public static DataSource fromValue(String value) {
        if (value == null) {
            return null;
        }
        for (DataSource source : DataSource.values()) {
            if (source.value.equalsIgnoreCase(value) || source.name().equalsIgnoreCase(value)) {
                return source;
            }
        }
        return null;
    }
}
