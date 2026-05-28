package com.radarview.auth.controller;

import com.radarview.auth.service.AuthService;
import com.radarview.common.dto.LoginRequest;
import com.radarview.common.dto.LoginResponse;
import com.radarview.common.dto.RegisterRequest;
import com.radarview.common.dto.UserInfo;
import com.radarview.common.result.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request);
        return ApiResponse.success(response);
    }

    @PostMapping("/register")
    public ApiResponse<LoginResponse> register(@Valid @RequestBody RegisterRequest request) {
        LoginResponse response = authService.register(request);
        return ApiResponse.success(response);
    }

    @PostMapping("/refresh")
    public ApiResponse<LoginResponse> refresh(@RequestHeader("Authorization") String bearerToken) {
        String accessToken = extractToken(bearerToken);
        LoginResponse response = authService.refreshToken(accessToken);
        return ApiResponse.success(response);
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(@RequestHeader("Authorization") String bearerToken) {
        String accessToken = extractToken(bearerToken);
        authService.logout(accessToken);
        return ApiResponse.success();
    }

    @GetMapping("/me")
    public ApiResponse<UserInfo> me(@RequestHeader("X-User-Id") Long userId) {
        UserInfo userInfo = authService.getUserInfo(userId);
        return ApiResponse.success(userInfo);
    }

    private String extractToken(String bearerToken) {
        if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return bearerToken;
    }
}
