package com.radarview.track.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitConfig {

    public static final String TRACK_IMPORT_QUEUE = "track.import.queue";
    public static final String TRACK_IMPORT_EXCHANGE = "track.import.exchange";
    public static final String TRACK_IMPORT_ROUTING_KEY = "track.import.#";

    public static final String TRACK_PROGRESS_QUEUE = "track.import.progress.queue";
    public static final String TRACK_PROGRESS_ROUTING_KEY = "track.import.progress";

    public static final String TRACK_RESULT_QUEUE = "track.import.result.queue";
    public static final String TRACK_RESULT_ROUTING_KEY = "track.import.result";

    @Bean
    public Queue trackImportQueue() {
        return new Queue(TRACK_IMPORT_QUEUE, true);
    }

    @Bean
    public Queue trackProgressQueue() {
        return new Queue(TRACK_PROGRESS_QUEUE, true);
    }

    @Bean
    public Queue trackResultQueue() {
        return new Queue(TRACK_RESULT_QUEUE, true);
    }

    @Bean
    public TopicExchange trackImportExchange() {
        return new TopicExchange(TRACK_IMPORT_EXCHANGE);
    }

    @Bean
    public Binding trackImportBinding(Queue trackImportQueue, TopicExchange trackImportExchange) {
        return BindingBuilder.bind(trackImportQueue).to(trackImportExchange).with(TRACK_IMPORT_ROUTING_KEY);
    }

    @Bean
    public Binding trackProgressBinding(Queue trackProgressQueue, TopicExchange trackImportExchange) {
        return BindingBuilder.bind(trackProgressQueue).to(trackImportExchange).with(TRACK_PROGRESS_ROUTING_KEY);
    }

    @Bean
    public Binding trackResultBinding(Queue trackResultQueue, TopicExchange trackImportExchange) {
        return BindingBuilder.bind(trackResultQueue).to(trackImportExchange).with(TRACK_RESULT_ROUTING_KEY);
    }

    @Bean
    public Jackson2JsonMessageConverter jackson2JsonMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory,
                                         Jackson2JsonMessageConverter messageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        return template;
    }
}
