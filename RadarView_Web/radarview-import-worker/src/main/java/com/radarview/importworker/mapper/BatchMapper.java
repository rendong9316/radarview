package com.radarview.importworker.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.radarview.importworker.entity.Batch;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface BatchMapper extends BaseMapper<Batch> {

    @Select("SELECT * FROM batches WHERE file_name = #{fileName}")
    Batch findByFileName(String fileName);

    @Update("UPDATE batches SET status = #{status}, track_count = #{trackCount}, " +
            "error_msg = #{errorMsg} WHERE id = #{id}")
    int updateStatus(Long id, String status, Integer trackCount, String errorMsg);
}
