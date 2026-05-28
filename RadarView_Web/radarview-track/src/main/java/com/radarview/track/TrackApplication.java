package com.radarview.track;

import lombok.extern.slf4j.Slf4j;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.context.annotation.Bean;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@Slf4j
@SpringBootApplication(scanBasePackages = {"com.radarview.track", "com.radarview.common"})
@EnableDiscoveryClient
@MapperScan("com.radarview.track.mapper")
public class TrackApplication {

    public static void main(String[] args) {
        SpringApplication.run(TrackApplication.class, args);
    }

    @Bean
    public CommandLineRunner ensureUploadDir() {
        return args -> {
            Path uploadDir = Paths.get("/data/uploads");
            try {
                Files.createDirectories(uploadDir);
                log.info("Upload directory ensured: {}", uploadDir.toAbsolutePath());
            } catch (IOException e) {
                log.error("Failed to create upload directory: {}", uploadDir, e);
            }
        };
    }
}
