package com.radarview.common.audit;

import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.time.LocalDateTime;

@Slf4j
@Aspect
@Component
public class AuditLogAspect {

    @Around("@annotation(com.radarview.common.audit.Auditable)")
    public Object audit(ProceedingJoinPoint joinPoint) throws Throwable {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        Auditable annotation = method.getAnnotation(Auditable.class);

        String action = annotation.action();
        String detail = annotation.detail();
        long start = System.currentTimeMillis();

        try {
            Object result = joinPoint.proceed();
            long duration = System.currentTimeMillis() - start;
            log.info("AUDIT | action={} | detail={} | duration={}ms | status=SUCCESS",
                action, detail, duration);
            return result;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - start;
            log.warn("AUDIT | action={} | detail={} | duration={}ms | status=FAILED | error={}",
                action, detail, duration, e.getMessage());
            throw e;
        }
    }
}
