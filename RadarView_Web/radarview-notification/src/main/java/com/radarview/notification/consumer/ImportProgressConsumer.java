package com.radarview.notification.consumer;

import com.radarview.notification.dto.ImportProgressMessage;
import com.radarview.notification.dto.ImportTaskResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class ImportProgressConsumer {

    private final SimpMessagingTemplate messagingTemplate;

    @RabbitListener(queues = "track.import.progress")
    public void handleImportProgress(ImportProgressMessage message) {
        log.info("Received import progress: batchId={}, userId={}, processed={}/{}",
                message.getBatchId(), message.getUserId(),
                message.getProcessedCount(), message.getTotalCount());

        messagingTemplate.convertAndSend(
                "/topic/import-progress/" + message.getUserId(),
                message
        );
    }

    @RabbitListener(queues = "track.import.result")
    public void handleImportResult(ImportTaskResult result) {
        log.info("Received import result: batchId={}, userId={}, status={}",
                result.getBatchId(), result.getUserId(), result.getStatus());

        messagingTemplate.convertAndSendToUser(
                result.getUserId(),
                "/queue/import-complete/" + result.getUserId(),
                result
        );
    }
}
