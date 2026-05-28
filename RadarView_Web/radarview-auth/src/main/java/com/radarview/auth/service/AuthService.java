package com.radarview.auth.service;

import cn.hutool.core.bean.BeanUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.radarview.auth.entity.SysRole;
import com.radarview.auth.entity.SysUser;
import com.radarview.auth.mapper.SysRoleMapper;
import com.radarview.auth.mapper.SysUserMapper;
import com.radarview.auth.security.JwtTokenProvider;
import com.radarview.auth.security.RedisTokenStore;
import com.radarview.common.dto.LoginRequest;
import com.radarview.common.dto.LoginResponse;
import com.radarview.common.dto.RegisterRequest;
import com.radarview.common.dto.UserInfo;
import com.radarview.common.exception.BusinessException;
import com.radarview.common.result.ResultCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private static final String ROLE_VIEWER = "ROLE_VIEWER";

    private final SysUserMapper sysUserMapper;
    private final SysRoleMapper sysRoleMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final RedisTokenStore redisTokenStore;

    @Value("${jwt.expiration}")
    private long expiration;

    @Value("${jwt.refresh-expiration}")
    private long refreshExpiration;

    public LoginResponse login(LoginRequest req) {
        SysUser user = sysUserMapper.selectOne(
                new LambdaQueryWrapper<SysUser>()
                        .eq(SysUser::getUsername, req.getUsername())
        );

        if (user == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "Invalid username or password");
        }

        if (!passwordEncoder.matches(req.getPassword(), user.getPassword())) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "Invalid username or password");
        }

        if (user.getEnabled() == null || user.getEnabled() != 1) {
            throw new BusinessException(ResultCode.FORBIDDEN, "Account is disabled");
        }

        List<String> roles = getRoleCodes(user.getId());

        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), user.getUsername(), roles);
        String refreshToken = jwtTokenProvider.generateRefreshToken();

        redisTokenStore.storeRefreshToken(refreshToken, user.getId(), refreshExpiration);

        return LoginResponse.builder()
                .accessToken(accessToken)
                .expiresIn(expiration / 1000)
                .nickname(user.getNickname())
                .roles(roles)
                .build();
    }

    @Transactional
    public LoginResponse register(RegisterRequest req) {
        Long count = sysUserMapper.selectCount(
                new LambdaQueryWrapper<SysUser>()
                        .eq(SysUser::getUsername, req.getUsername())
        );
        if (count != null && count > 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "Username already exists");
        }

        SysUser user = new SysUser();
        user.setUsername(req.getUsername());
        user.setPassword(passwordEncoder.encode(req.getPassword()));
        user.setNickname(req.getNickname() != null ? req.getNickname() : req.getUsername());
        user.setEmail(req.getEmail());
        user.setEnabled(1);
        user.setCreatedAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());

        sysUserMapper.insert(user);

        List<String> roles = getRoleCodes(user.getId());

        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), user.getUsername(), roles);
        String refreshToken = jwtTokenProvider.generateRefreshToken();

        redisTokenStore.storeRefreshToken(refreshToken, user.getId(), refreshExpiration);

        return LoginResponse.builder()
                .accessToken(accessToken)
                .expiresIn(expiration / 1000)
                .nickname(user.getNickname())
                .roles(roles)
                .build();
    }

    public LoginResponse refreshToken(String accessToken) {
        if (!jwtTokenProvider.validateToken(accessToken)) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "Invalid or expired token");
        }

        Long userId = jwtTokenProvider.getUserIdFromToken(accessToken);
        String username = jwtTokenProvider.getUsernameFromToken(accessToken);
        List<String> roles = getRoleCodes(userId);

        String newAccessToken = jwtTokenProvider.generateAccessToken(userId, username, roles);
        String newRefreshToken = jwtTokenProvider.generateRefreshToken();

        redisTokenStore.storeRefreshToken(newRefreshToken, userId, refreshExpiration);

        return LoginResponse.builder()
                .accessToken(newAccessToken)
                .expiresIn(expiration / 1000)
                .nickname(username)
                .roles(roles)
                .build();
    }

    public void logout(String accessToken) {
        if (accessToken != null && jwtTokenProvider.validateToken(accessToken)) {
            Long userId = jwtTokenProvider.getUserIdFromToken(accessToken);
            String jti = String.valueOf(userId) + "_" + System.currentTimeMillis();
            redisTokenStore.blacklistAccessToken(jti, expiration);
        }
    }

    public UserInfo getUserInfo(Long userId) {
        SysUser user = sysUserMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "User not found");
        }

        List<String> roles = getRoleCodes(userId);

        UserInfo userInfo = new UserInfo();
        userInfo.setId(user.getId());
        userInfo.setUsername(user.getUsername());
        userInfo.setNickname(user.getNickname());
        userInfo.setEmail(user.getEmail());
        userInfo.setRoles(roles);
        userInfo.setEnabled(user.getEnabled() != null && user.getEnabled() == 1);

        return userInfo;
    }

    private List<String> getRoleCodes(Long userId) {
        try {
            List<SysRole> roles = sysRoleMapper.findByUserId(userId);
            if (roles == null || roles.isEmpty()) {
                return Collections.singletonList(ROLE_VIEWER);
            }
            return roles.stream()
                    .map(SysRole::getRoleCode)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.warn("Failed to load roles for user {}, defaulting to ROLE_VIEWER", userId, e);
            return Collections.singletonList(ROLE_VIEWER);
        }
    }
}
