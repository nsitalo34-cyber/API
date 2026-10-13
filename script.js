const $ = selector => document.querySelector(selector);
const form = $('#freightForm');
const cepInput = $('#cep');
const lookupButton = $('#lookupButton');
const cepStatus = $('#cepStatus');
const formStatus = $('#formStatus');
const addressBox = $('#addressBox');
const resultCard = $('#resultCard');
let destination = null;

$('#year').textContent = new Date().getFullYear();

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}
function money(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function setStatus(element, message, type = '') {
  element.textContent = message;
  element.className = element === cepStatus ? 'field-status ' + type : 'form-status ' + type;
}
function formatCep(value) {
  const d = digits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
cepInput.addEventListener('input', () => {
  cepInput.value = formatCep(cepInput.value);
});

async function lookupCep() {
  const cep = digits(cepInput.value);
  destination = null;
  addressBox.hidden = true;
  resultCard.hidden = true;
  if (cep.length !== 8) {
    setStatus(cepStatus, 'Digite um CEP válido com 8 números.', 'error');
    return;
  }

  lookupButton.disabled = true;
  lookupButton.textContent = 'Buscando…';
  setStatus(cepStatus, 'Consultando a API ViaCEP…');

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!response.ok) throw new Error('Não foi possível consultar o CEP agora.');
    const data = await response.json();
    if (data.erro) throw new Error('CEP não encontrado. Confira os números digitados.');
    destination = data;
    const title = [data.logradouro, data.bairro].filter(Boolean).join(', ') || 'Região do CEP';
    const details = [data.localidade, data.uf, `CEP ${formatCep(data.cep)}`].filter(Boolean).join(' · ');
    $('#addressTitle').textContent = title;
    $('#addressDetails').textContent = details;
    addressBox.hidden = false;
    setStatus(cepStatus, 'CEP encontrado. Confira o endereço abaixo.', 'success');
  } catch (error) {
    setStatus(cepStatus, error.message || 'Erro ao consultar o CEP. Tente novamente.', 'error');
  } finally {
    lookupButton.disabled = false;
    lookupButton.textContent = 'Buscar CEP';
  }
}
lookupButton.addEventListener('click', lookupCep);
cepInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupCep();
  }
});

async function geocode(query) {
  // Busca pontual iniciada pelo usuário. Respeite a política pública do Nominatim.
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const response = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!response.ok) throw new Error('Não foi possível localizar um dos endereços no mapa.');
  const data = await response.json();
  if (!data.length) throw new Error('Endereço não localizado no mapa. Tente informar o endereço completo e a cidade.');
  return { lat: Number(data[0].lat), lon: Number(data[0].lon), label: data[0].display_name };
}

async function route(origin, dest) {
  // OSRM usa perfil driving: a rota de carro é uma aproximação, não uma rota oficial de moto.
  const coords = `${origin.lon},${origin.lat};${dest.lon},${dest.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&alternatives=false&steps=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível calcular a rota neste momento.');
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new Error('Não encontramos uma rota entre os endereços informados.');
  }
  return data.routes[0];
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  resultCard.hidden = true;
  setStatus(formStatus, '');

  if (!destination || digits(destination.cep) !== digits(cepInput.value)) {
    setStatus(formStatus, 'Busque e confirme o CEP antes de calcular o frete.', 'error');
    await lookupCep();
    if (!destination) return;
  }

  const originText = $('#origin').value.trim();
  const base = Number($('#baseFare').value);
  const perKm = Number($('#perKm').value);
  if (!originText) {
    setStatus(formStatus, 'Informe o ponto de partida.', 'error');
    return;
  }
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(perKm) || perKm < 0) {
    setStatus(formStatus, 'Informe tarifas válidas, iguais ou maiores que zero.', 'error');
    return;
  }

  const button = $('#calculateButton');
  button.disabled = true;
  button.innerHTML = 'Calculando rota…';
  setStatus(formStatus, 'Localizando os endereços e consultando a rota. Isso pode levar alguns segundos.');

  try {
    const destinationQuery = [
      destination.logradouro,
      destination.bairro,
      destination.localidade,
      destination.uf,
      destination.cep,
      'Brasil'
    ].filter(Boolean).join(', ');

    const originCoords = await geocode(originText);
    // Pequena pausa entre consultas para respeitar a política do serviço público.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const destinationCoords = await geocode(destinationQuery);
    const routeData = await route(originCoords, destinationCoords);

    const km = routeData.distance / 1000;
    const minutes = Math.round(routeData.duration / 60);
    const total = base + km * perKm;
    $('#resultPrice').textContent = money(total);
    $('#resultDistance').textContent = `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
    $('#resultDuration').textContent = minutes < 60 ? `~${minutes} min` : `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    $('#resultFormula').textContent = `Cálculo demonstrativo: ${money(base)} de tarifa base + ${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km × ${money(perKm)}/km.`;
    const mapUrl = new URL('https://www.openstreetmap.org/directions');
    mapUrl.searchParams.set('engine', 'fossgis_osrm_car');
    mapUrl.searchParams.set('route', `${originCoords.lat}%2C${originCoords.lon}%3B${destinationCoords.lat}%2C${destinationCoords.lon}`);
    $('#mapLink').href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originText)}&destination=${encodeURIComponent(destinationQuery)}`;
    resultCard.hidden = false;
    setStatus(formStatus, 'Estimativa calculada! Confira os detalhes abaixo.', 'success');
  } catch (error) {
    setStatus(formStatus, error.message || 'Ocorreu um erro ao calcular. Tente novamente mais tarde.', 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Calcular distância e frete <span>→</span>';
  }
});
