-- =============================================================================
-- Migration 033: Regulation Center — RLS updates on regulatory_changes,
-- semantic search RPC for document_chunks (pgvector).
-- =============================================================================

-- Allow org members with obligations.assign to update regulatory_changes (inbox actions).
drop policy if exists "Members update regulatory changes with assign" on public.regulatory_changes;
create policy "Members update regulatory changes with assign"
  on public.regulatory_changes for update to authenticated
  using (
    public.is_founder()
    or (
      organization_id = public.current_organization_id()
      and public.has_permission('obligations.assign', organization_id)
    )
  )
  with check (
    public.is_founder()
    or organization_id = public.current_organization_id()
  );

-- Vector similarity search for Regulation Center RAG (384-dim embeddings).
create or replace function public.match_regulation_chunks(
  query_embedding vector(384),
  p_organization_id uuid,
  match_count int default 15
)
returns setof public.document_chunks
language sql
stable
as $$
  select *
  from public.document_chunks
  where organization_id = p_organization_id
    and regulatory_change_id is not null
    and embedding is not null
  order by embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 15), 50));
$$;

grant execute on function public.match_regulation_chunks(vector, uuid, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
