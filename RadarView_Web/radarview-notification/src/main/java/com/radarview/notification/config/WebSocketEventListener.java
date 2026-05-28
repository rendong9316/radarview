package com.radarview.notification.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.Principal;

@Slf4j
@Component
public class WebSocketEventListener {

    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        Principal principal = event.getUser();
        if (principal != null) {
            log.info("WebSocket disconnected: user={}, sessionId={}",
                    principal.getName(), event.getSessionId());
        } else {
            log.info("WebSocket disconnected: sessionId={}", event.getSessionId());
        }
    }
}
