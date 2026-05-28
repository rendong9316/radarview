package com.radarview.track.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.radarview.track.entity.Batch;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface BatchMapper extends BaseMapper<Batch> {

    @Select("SELECT * FROM batches WHERE file_name = #{fileName}")
    Batch findByFileName(String fileName);

    @Select("SELECT * FROM batches WHERE status = #{status}")
    List<Batch> findByStatus(String status);
}
