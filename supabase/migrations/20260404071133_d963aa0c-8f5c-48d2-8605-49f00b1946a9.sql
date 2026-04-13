
-- Create warehouse_projects table
CREATE TABLE public.warehouse_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Project 1',
  params JSONB NOT NULL DEFAULT '{"rows":2,"racks":10,"deep":2,"slotsPerRack":5,"length":6,"width":5,"height":4}'::jsonb,
  component_styles JSONB NOT NULL DEFAULT '{}'::jsonb,
  warehouse_offset_2d JSONB NOT NULL DEFAULT '{"x":0,"y":0}'::jsonb,
  warehouse_offset_3d JSONB NOT NULL DEFAULT '[0,0]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.warehouse_projects ENABLE ROW LEVEL SECURITY;

-- Users can only access their own projects
CREATE POLICY "Users can view their own projects"
  ON public.warehouse_projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects"
  ON public.warehouse_projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects"
  ON public.warehouse_projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects"
  ON public.warehouse_projects FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_warehouse_projects_updated_at
  BEFORE UPDATE ON public.warehouse_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
