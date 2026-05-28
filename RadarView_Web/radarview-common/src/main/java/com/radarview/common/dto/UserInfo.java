package com.radarview.common.dto;

import lombok.Data;

import java.util.List;

@Data
public class UserInfo {

    private Long id;

    private String username;

    private String nickname;

    private String email;

    private List<String> roles;

    private Boolean enabled;
}
