package com.radarview.auth.security;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
public class RedisTokenStore {

    private static final String ACCESS_TOKEN_BLACKLIST_PREFIX = "token:blacklist:";
    private static final String REFRESH_TOKEN_PREFIX = "token:refresh:";

    private final StringRedisTemplate redisTemplate;

    public RedisTokenStore(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void blacklistAccessToken(String jti, long expirationMs) {
        String key = ACCESS_TOKEN_BLACKLIST_PREFIX + jti;
        redisTemplate.opsForValue().set(key, "1", expirationMs, TimeUnit.MILLISECONDS);
    }

    public boolean isBlacklisted(String jti) {
        String key = ACCESS_TOKEN_BLACKLIST_PREFIX + jti;
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }

    public void storeRefreshToken(String token, Long userId, long expirationMs) {
        String key = REFRESH_TOKEN_PREFIX + token;
        redisTemplate.opsForValue().set(key, String.valueOf(userId), expirationMs, TimeUnit.MILLISECONDS);
    }

    public Long getUserIdByRefreshToken(String token) {
        String key = REFRESH_TOKEN_PREFIX + token;
        String userIdStr = redisTemplate.opsForValue().get(key);
        if (userIdStr != null) {
            return Long.valueOf(userIdStr);
        }
        return null;
    }

    public void deleteRefreshToken(String token) {
        String key = REFRESH_TOKEN_PREFIX + token;
        redisTemplate.delete(key);
    }
}
