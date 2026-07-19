alter table chunks add column content_tsv tsvector
    generated always as (to_tsvector('english', content)) stored;

create index chunks_content_tsv_idx on chunks using gin (content_tsv);
