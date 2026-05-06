export const provider = (defaultAwsRegion: string, targetAwsRegion: string): { $provider: string } => {
  return defaultAwsRegion !== targetAwsRegion
    ? { $provider: `aws.${targetAwsRegion.split('-').join('_')}` }
    : {} as any;
};
