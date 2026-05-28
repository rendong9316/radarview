package com.radarview.notification.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Principal;

@Slf4j
@Component
@RequiredArgsConstructor
public class StompAuthInterceptor implements ChannelInterceptor {

    private final com.radarview.notification.security.JwtTokenProvider jwtTokenProvider;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            String authHeader = accessor.getFirstNativeHeader("Authorization");

            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);

                if (jwtTokenProvider.validateToken(token)) {
                    Long userId = jwtTokenProvider.getUserIdFromToken(token);
                    String username = jwtTokenProvider.getUsernameFromToken(token);

                    Principal principal = new StompPrincipal(userId, username);
                    accessor.setUser(principal);

                    log.debug("STOMP authenticated: userId={}, username={}", userId, username);
                } else {
                    log.warn("STOMP authentication failed: invalid token");
                    throw new IllegalArgumentException("Invalid token");
                }
            } else {
                log.warn("STOMP CONNECT without Authorization header");
                throw new IllegalArgumentException("Authorization header required");
            }
        }

        return message;
    }

    public record StompPrincipal(Long userId, String username) implements Principal {

        @Override
        public String getName() {
            return username;
        }
    }
}
