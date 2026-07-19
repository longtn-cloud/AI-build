alter table chat_messages
    add column used_general_knowledge boolean not null default false;
