package com.radarview.common.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class LoginResponse {

    private String accessToken;

    private Long expiresIn;

    private String nickname;

    private List<String> roles;
}
