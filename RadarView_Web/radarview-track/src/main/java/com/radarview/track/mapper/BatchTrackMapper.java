package com.radarview.track.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.radarview.track.entity.BatchTrack;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface BatchTrackMapper extends BaseMapper<BatchTrack> {

    @Select("SELECT * FROM batch_tracks WHERE batch_id = #{batchId}")
    List<BatchTrack> findByBatchId(Long batchId);

    @Delete("DELETE FROM batch_tracks WHERE batch_id = #{batchId}")
    int deleteByBatchId(Long batchId);

    @Select("SELECT * FROM batch_tracks WHERE icao_address = #{icaoAddress}")
    List<BatchTrack> findByIcaoAddress(String icaoAddress);
}
