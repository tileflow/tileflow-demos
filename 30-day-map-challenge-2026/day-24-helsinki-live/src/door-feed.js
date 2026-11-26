// Subscribe only to the selected bus. The whole fleet is already in the lean GTFS-RT view.
let socket,
  topic,
  revision = 0;
export async function trackDetail(id, onReading) {
  const request = ++revision;
  if (socket && topic) socket.unsubscribe(topic);
  topic = undefined;
  if (!id) {
    socket?.end(true);
    socket = undefined;
    return;
  }
  const {default: mqtt} = await import('mqtt');
  if (request !== revision) return;
  if (!socket) {
    socket = mqtt.connect('wss://mqtt.hsl.fi/', {connectTimeout: 8000, reconnectPeriod: 6000});
    socket.on('error', () => {}); // GTFS-RT stays available even if WebSockets are blocked.
  }
  socket.removeAllListeners('message');
  const [operator, vehicle] = id.split('/');
  if (!vehicle) return;
  topic =
    '/hfp/v2/journey/ongoing/vp/bus/' + operator.padStart(4, '0') + '/' + vehicle.padStart(5, '0') + '/#';
  socket.on('message', (channel, bytes) => {
    if (request !== revision || !channel.startsWith(topic.slice(0, -1))) return;
    try {
      const reading = JSON.parse(bytes.toString()).VP;
      if (reading) onReading(reading, channel.split('/')[9]);
    } catch {
      /* Ignore incomplete readings. */
    }
  });
  socket.subscribe(topic);
}
