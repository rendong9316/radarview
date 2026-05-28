package com.radarview.tile;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

@SpringBootApplication
@EnableDiscoveryClient
public class TileApplication {

    public static void main(String[] args) {
        SpringApplication.run(TileApplication.class, args);
    }
}
