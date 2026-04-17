-- Create scenarios table for storing saved scenarios
-- This table stores all configuration and inputs for a scenario

CREATE TABLE IF NOT EXISTS scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_name TEXT NOT NULL,
  description TEXT,
  scenario_data JSONB,
  model_setup JSONB,
  ace_inputs JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Create index on created_at for faster sorting
CREATE INDEX IF NOT EXISTS idx_scenarios_created_at ON scenarios(created_at DESC);

-- Create index on scenario_name for search
CREATE INDEX IF NOT EXISTS idx_scenarios_name ON scenarios(scenario_name);

-- Enable Row Level Security (RLS)
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anyone to read scenarios (no auth required)
CREATE POLICY "Allow public read on scenarios" 
  ON scenarios 
  FOR SELECT 
  USING (true);

-- Create policy to allow anyone to insert scenarios
CREATE POLICY "Allow public insert on scenarios"
  ON scenarios
  FOR INSERT
  WITH CHECK (true);

-- Create policy to allow anyone to delete scenarios
CREATE POLICY "Allow public delete on scenarios"
  ON scenarios
  FOR DELETE
  USING (true);

-- Create policy to allow anyone to update scenarios
CREATE POLICY "Allow public update on scenarios"
  ON scenarios
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
