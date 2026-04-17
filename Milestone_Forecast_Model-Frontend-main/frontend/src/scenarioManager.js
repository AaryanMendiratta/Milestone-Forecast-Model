const BASE_URL = import.meta.env.VITE_API_URL ?? '';

async function handleResponse(res, fallbackMessage) {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => res.statusText);
    }
    throw new Error(detail || fallbackMessage || res.statusText);
  }
  return res.json();
}

export async function saveScenario(name, description, data) {
  const res = await fetch(`${BASE_URL}/api/scenarios/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario_name: name,
      description: description || null,
      scenario_data: data,
    }),
  });
  return handleResponse(res, 'Failed to save scenario');
}

export async function loadScenarioList() {
  const res = await fetch(`${BASE_URL}/api/scenarios/list`);
  const data = await handleResponse(res, 'Failed to load scenarios');
  return data.scenarios || [];
}

export async function loadScenario(id) {
  const res = await fetch(`${BASE_URL}/api/scenarios/${encodeURIComponent(id)}`);
  const data = await handleResponse(res, 'Failed to load scenario');
  return data.scenario;
}

export async function deleteScenario(id) {
  const res = await fetch(`${BASE_URL}/api/scenarios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return handleResponse(res, 'Failed to delete scenario');
}

