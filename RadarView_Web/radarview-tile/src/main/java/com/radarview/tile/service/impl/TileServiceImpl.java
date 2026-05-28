package com.radarview.tile.service.impl;

import com.radarview.tile.service.TileService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

@Slf4j
@Service
public class TileServiceImpl implements TileService {

    @Value("${tile.mbtiles-path}")
    private String mbtilesPath;

    @Override
    @Cacheable(value = "tiles", key = "#z + ':' + #x + ':' + #y")
    public byte[] getTile(int z, int x, int y) {
        int tmsY = (1 << z) - 1 - y;

        String sql = "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?";

        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + mbtilesPath);
             PreparedStatement ps = conn.prepareStatement(sql)) {

            ps.setInt(1, z);
            ps.setInt(2, x);
            ps.setInt(3, tmsY);

            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return rs.getBytes("tile_data");
                }
            }
        } catch (Exception e) {
            log.error("Failed to get tile z={} x={} y={} (tmsY={}): {}", z, x, y, tmsY, e.getMessage());
        }

        return null;
    }
}
