-- Relax semantic search threshold for kit matching during rollout/testing.
drop function if exists public.match_kits(vector, int, float);

create or replace function public.match_kits(
  query_embedding   vector(1536),
  match_count       int default 3,
  match_threshold   float default 0.20
)
returns table (
  kit_id             uuid,
  slug               text,
  name               text,
  trade              text,
  description        text,
  task_description   text,
  keywords           text[],
  search_keywords    text[],
  similarity         float,
  items              jsonb
)
language sql
stable
as $$
  with ranked as (
    select
      k.id,
      k.slug,
      k.name,
      k.trade,
      k.description,
      k.task_description,
      k.keywords,
      k.search_keywords,
      1 - (k.embedding <=> query_embedding) as similarity
    from public.kits k
    where k.embedding is not null
    order by k.embedding <=> query_embedding
    limit match_count
  )
  select
    r.id as kit_id,
    r.slug,
    r.name,
    r.trade,
    r.description,
    r.task_description,
    r.keywords,
    r.search_keywords,
    r.similarity,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'product_id',   ki.product_id,
            'product_name', ki.product_name,
            'unit',         ki.unit,
            'per_m2',       ki.per_m2,
            'base_qty',     ki.base_qty
          )
          order by ki.display_order
        )
        from public.kit_items ki
        where ki.kit_id = r.id
      ),
      '[]'::jsonb
    ) as items
  from ranked r
  where r.similarity >= match_threshold;
$$;