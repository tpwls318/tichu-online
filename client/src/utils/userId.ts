export const getUserId = (): string => {
  return localStorage.getItem('tichu_user_id') || '';
};
