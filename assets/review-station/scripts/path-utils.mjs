export const toViteFsUrl = (sourcePath) => {
  const normalized = sourcePath.replaceAll('\\', '/');
  return encodeURI(normalized.startsWith('/') ? `/@fs${normalized}` : `/@fs/${normalized}`);
};
