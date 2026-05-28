package com.radarview.importworker;

import lombok.extern.slf4j.Slf4j;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

@Slf4j
@SpringBootApplication(scanBasePackages = {"com.radarview.importworker", "com.radarview.common"})
@EnableDiscoveryClient
@MapperScan("com.radarview.importworker.mapper")
public class ImportWorkerApplication {

    public static void main(String[] args) {
        SpringApplication.run(ImportWorkerApplication.class, args);
    }
}
