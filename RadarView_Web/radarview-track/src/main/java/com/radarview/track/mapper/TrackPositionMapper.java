package com.radarview.track.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.radarview.track.entity.TrackPosition;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface TrackPositionMapper extends BaseMapper<TrackPosition> {

    @Select("SELECT * FROM track_positions WHERE track_id = #{trackId} ORDER BY timestamp")
    List<TrackPosition> findByTrackId(Long trackId);

    @Delete("DELETE FROM track_positions WHERE batch_id = #{batchId}")
    int deleteByBatchId(Long batchId);

    @Select("SELECT COUNT(*) FROM track_positions WHERE track_id = #{trackId}")
    int countByTrackId(Long trackId);
}
